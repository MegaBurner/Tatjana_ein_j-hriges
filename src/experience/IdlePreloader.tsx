import { Suspense, useCallback, useEffect, useState } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  markSRGB,
  PHOTO_URLS,
  preloadSongCovers,
  scheduleIdle,
  uploadTexturesStaggered,
  warmLetterModalChunk,
} from "./preloadAssets";

/**
 * Lädt nach dem Hero-First-Paint alle lazy Section-Assets in
 * Scroll-Reihenfolge vor (Details/Begründung: preloadAssets.ts). Gemountet
 * wird die Komponente in HeroSection — Experience.tsx hat fremde
 * uncommittete Änderungen und bleibt unangetastet. Jede Phase läuft in
 * einem eigenen Idle-Fenster, die Foto-GPU-Uploads zusätzlich gestaffelt
 * (eine Textur pro Idle-Step); vor dem ersten Idle-Fenster passiert gar
 * nichts, der Hero-First-Paint wird also nie verzögert.
 */

/** Ablauf: waiting → photos (Section 1) → covers (Section 2) →
 *  chunk (LetterModal/framer-motion) → done. */
type PreloadPhase = "waiting" | "photos" | "covers" | "chunk" | "done";

/**
 * Suspendiert auf alle 8 Buch-Fotos mit exakt demselben useLoader-Cache-Key
 * wie `useTexture(PHOTO_URLS)` in PhotosSection — wenn die Section später
 * bei Annäherung mountet, kommt alles synchron aus dem Cache. Nach dem
 * Laden: sRGB markieren (wie der onLoad-Callback in PhotosSection, muss vor
 * dem Upload passieren) und gestaffelt auf die GPU hochladen.
 */
function PhotoWarmup({ onDone }: { onDone: () => void }) {
  const gl = useThree((state) => state.gl);
  const textures = useLoader(THREE.TextureLoader, PHOTO_URLS);

  useEffect(() => {
    markSRGB(textures);
    return uploadTexturesStaggered(gl, textures, onDone);
  }, [gl, textures, onDone]);

  return null;
}

const IdlePreloader = () => {
  const [phase, setPhase] = useState<PreloadPhase>("waiting");

  useEffect(() => {
    if (phase === "waiting") {
      // Startsignal erst im ersten Idle-Fenster nach dem Mount — bis dahin
      // rendert die Komponente nichts und löst keinerlei Loads aus.
      return scheduleIdle(() => setPhase("photos"));
    }
    if (phase === "covers") {
      return scheduleIdle(() => {
        preloadSongCovers();
        setPhase("chunk");
      });
    }
    if (phase === "chunk") {
      return scheduleIdle(() => {
        warmLetterModalChunk();
        setPhase("done");
      });
    }
    return undefined;
  }, [phase]);

  // Fotos fertig (geladen + auf GPU) → weiter in Scroll-Reihenfolge.
  const handlePhotosDone = useCallback(() => setPhase("covers"), []);

  if (phase === "waiting") return null;
  return (
    // Eigene Suspense-Grenze: das Suspendieren des Warmups darf nie die
    // umgebende Szene (Hero) zurück in einen Fallback zwingen.
    <Suspense fallback={null}>
      <PhotoWarmup onDone={handlePhotosDone} />
    </Suspense>
  );
};

export default IdlePreloader;
