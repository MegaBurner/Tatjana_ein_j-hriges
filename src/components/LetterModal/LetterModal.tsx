import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import "./LetterModal.css";

const resolvePath = (path: string) =>
  import.meta.env.BASE_URL + path.replace(/^\//, "");

// Vorgerendert via:
//   pdftoppm -jpeg -r 110 -jpegopt quality=82 public/notiz.pdf public/letter-pages/seite
// Ergebnis: 1 Seite (seite-1.jpg, ~150 kB) — unter 10 Seiten vergibt pdftoppm
// keine Nullen-Präfixe, daher reicht "seite-N.jpg" ohne Padding.
const LETTER_PAGE_COUNT = 1;

function letterPageUrl(page: number): string {
  return resolvePath(`/letter-pages/seite-${page}.jpg`);
}

interface LetterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Stilvoller In-Site-Briefviewer — ersetzt das rohe Browser-PDF-Chrome
 * (graue Toolbar, Zoom-Buttons) durch vorgerenderte Seiten-JPEGs in einer
 * Creme-Papier-Karte mit Gold-Akzent, passend zum restlichen Design.
 */
const LetterModal = ({ isOpen, onClose }: LetterModalProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const hasMultiplePages = LETTER_PAGE_COUNT > 1;

  // Beim erneuten Öffnen immer auf Seite 1 zurücksetzen — als Render-Phase-
  // Anpassung statt Effect (vermeidet einen zusätzlichen Commit-Zyklus,
  // siehe „Adjusting state when a prop changes" in den React-Docs).
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setPage(1);
  }

  // ESC schließt — Fokus auf die Karte legen, damit ESC nicht irgendwo
  // im Hintergrund verschluckt wird (gleiches Muster wie PDFModal).
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
      cardRef.current?.focus();
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        className="letter-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="letter-modal-card"
          ref={cardRef}
          tabIndex={-1}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="letter-modal-close"
            onClick={onClose}
            aria-label="Schließen"
          >
            <X size={20} />
          </button>

          <h2 className="letter-modal-heading">Ein Brief für dich</h2>

          <div className="letter-modal-page-frame">
            <img
              src={letterPageUrl(page)}
              alt={`Brief, Seite ${page}`}
              className="letter-modal-page-image"
            />
          </div>

          {hasMultiplePages && (
            <div className="letter-modal-nav">
              <button
                type="button"
                className="letter-modal-nav-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Vorherige Seite"
              >
                ‹
              </button>
              <span className="letter-modal-page-label">
                Seite {page} / {LETTER_PAGE_COUNT}
              </span>
              <button
                type="button"
                className="letter-modal-nav-btn"
                onClick={() =>
                  setPage((p) => Math.min(LETTER_PAGE_COUNT, p + 1))
                }
                disabled={page >= LETTER_PAGE_COUNT}
                aria-label="Nächste Seite"
              >
                ›
              </button>
            </div>
          )}

          <a
            className="letter-modal-download"
            href={resolvePath("/notiz.pdf")}
            download="Brief_fuer_Tatjana.pdf"
          >
            PDF herunterladen
          </a>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

export default LetterModal;
