import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download } from 'lucide-react';
import './PDFModal.css';

interface PDFModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
}

const PDFModal = ({ isOpen, onClose, pdfUrl }: PDFModalProps) => {
  const contentRef = useRef<HTMLDivElement>(null);

  // ESC key handler — Fokus auf den Modal-Container legen, damit ESC nicht
  // im <object>-PDF-Viewer verschluckt wird
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden'; // Prevent scroll
      contentRef.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = 'Brief_fuer_Tatjana.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div 
        className="pdf-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="pdf-modal-content"
          ref={contentRef}
          tabIndex={-1}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* PDF Viewer - using object for fallback support */}
          {/* Added params to hide sidebar but keep toolbar for zoom/pan */}
          <object
            data={`${pdfUrl}#navpanes=0`}
            type="application/pdf"
            className="pdf-iframe"
            title="Brief für Tatjana"
          >
            <div style={{ padding: '2rem', textAlign: 'center', color: 'white' }}>
              <p>PDF konnte nicht direkt angezeigt werden.</p>
              <p>Bitte nutze den Download-Button unten.</p>
            </div>
          </object>

          {/* Footer Controls */}
          <div className="pdf-modal-footer">
            <button className="pdf-modal-btn secondary" onClick={onClose}>
              <X size={18} />
              Schließen
            </button>
            <button className="pdf-modal-btn primary" onClick={handleDownload}>
              <Download size={18} />
              PDF herunterladen
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default PDFModal;
