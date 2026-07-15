import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { DinoGame } from "../../game/DinoGame";
import { loadAtlas } from "../../game/sprites";
import "./ArcadeModal.css";

interface ArcadeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Fullscreen-Overlay mit dem Dino-Runner in groß — geöffnet per Klick auf
 * den Laptop in der Arcade-Section oder direkt via ?game=1 (Sharing &
 * Screenshot-Verifikation). Steuerung: Leertaste/↑/Tippen springt,
 * ↓ bzw. Touch-Button duckt, Esc schließt.
 */
const ArcadeModal = ({ isOpen, onClose }: ArcadeModalProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<DinoGame | null>(null);
  const [hasLoadError, setHasLoadError] = useState(false);

  // Spiel-Lebenszyklus: Atlas laden → Spiel starten; beim Schließen
  // destroy() (räumt rAF-Loop und globale Tastatur-Listener ab).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadAtlas()
      .then((atlas) => {
        if (cancelled || !canvasRef.current) return;
        const game = new DinoGame(canvasRef.current, atlas);
        gameRef.current = game;
        game.start();
      })
      .catch(() => {
        if (!cancelled) setHasLoadError(true);
      });
    return () => {
      cancelled = true;
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    // Fokus auf die Karte: SnapController ignoriert Tasten, sobald nicht
    // mehr body fokussiert ist — Space/Pfeile scrollen dann nicht mehr die
    // Seite hinter dem Spiel (gleiches Muster wie LetterModal).
    cardRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        className="arcade-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="arcade-modal-card"
          ref={cardRef}
          tabIndex={-1}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="arcade-modal-close"
            onClick={onClose}
            aria-label="Spiel schließen"
          >
            <X size={20} />
          </button>

          {hasLoadError ? (
            <p className="arcade-modal-error">
              Das Spiel konnte nicht geladen werden — lad die Seite einmal neu.
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              className="arcade-canvas"
              onPointerDown={() => gameRef.current?.restartOrJump()}
              onPointerUp={() => gameRef.current?.jumpRelease()}
            />
          )}

          {/* Nur auf Touch-Geräten sichtbar (CSS: pointer coarse) */}
          <div className="arcade-touch-controls">
            <button
              onPointerDown={() => gameRef.current?.restartOrJump()}
              onPointerUp={() => gameRef.current?.jumpRelease()}
              onPointerLeave={() => gameRef.current?.jumpRelease()}
              aria-label="Springen"
            >
              ↑ Springen
            </button>
            <button
              onPointerDown={() => gameRef.current?.duckOn()}
              onPointerUp={() => gameRef.current?.duckOff()}
              onPointerLeave={() => gameRef.current?.duckOff()}
              onPointerCancel={() => gameRef.current?.duckOff()}
              aria-label="Ducken"
            >
              ↓ Ducken
            </button>
          </div>

          <p className="arcade-modal-hint">
            Leertaste / ↑ springen &nbsp;·&nbsp; ↓ ducken &nbsp;·&nbsp; Esc
            schließen
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

export default ArcadeModal;
