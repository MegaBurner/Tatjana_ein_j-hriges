import { motion } from 'framer-motion';
import VinylRecord from '../components/VinylRecord/VinylRecord';
import PageNavigation from '../components/Navigation/PageNavigation';
import './VinylPage.css';

interface VinylPageProps {
  currentPage: number;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentSong: { src: string; cover: string };
  onNextSong: () => void;
  onPrevSong: () => void;
}

const VinylPage = ({ 
  currentPage, 
  totalPages, 
  onNext, 
  onPrev, 
  audioRef,
  currentSong,
  onNextSong,
  onPrevSong
}: VinylPageProps) => {
  return (
    <div className="vinyl-page">
      {/* Decorative Blur Blobs */}
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />

      <motion.h2 
        className="vinyl-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        Diese 2 songs erinnern mich an dich.
      </motion.h2>

      <motion.p
        className="vinyl-subtitle"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        style={{ maxWidth: '600px', margin: '0 auto', lineHeight: '1.5' }}
      >
        es erinnern mich noch tausend andere songs an dich aber die würde ich dir lieber bei einem late night drive durch paris mal zeigen
      </motion.p>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}
      >
        <VinylRecord 
          audioRef={audioRef} 
          coverImage={currentSong.cover} 
          onNextSong={onNextSong}
          onPrevSong={onPrevSong}
        />
      </motion.div>

      <PageNavigation
        currentPage={currentPage}
        totalPages={totalPages}
        onNext={onNext}
        onPrev={onPrev}
      />
    </div>
  );
};

export default VinylPage;
