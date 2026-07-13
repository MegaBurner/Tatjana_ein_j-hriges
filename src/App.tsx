import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StartPage from './pages/StartPage';
import PhotosPage from './pages/PhotosPage';
import VinylPage from './pages/VinylPage';
import LetterPage from './pages/LetterPage';
import PeonyPage from './pages/PeonyPage';
import CanvasBackgroundEffects from './components/Effects/CanvasBackgroundEffects';
import { detectWebGL } from './three/hooks/useWebGL';

const BackgroundScene = lazy(() => import('./three/BackgroundScene'));

// Memory images from public/memories/
// Helper to handle base path for GitHub Pages
const resolvePath = (path: string) => {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
};

// Memory images from public/memories/
const memoryImages: string[] = [
  resolvePath('/memories/IMG_4891.JPG'),
  resolvePath('/memories/IMG_4909.JPG'),
  resolvePath('/memories/IMG_4913.JPG'),
  resolvePath('/memories/IMG_5006.JPG'),
  resolvePath('/memories/IMG_6280.JPG'),
  resolvePath('/memories/IMG_7321.JPG'),
  resolvePath('/memories/IMG_7411.jpg'),
  resolvePath('/memories/a861063c-5a40-4df8-acaf-398ef7aa81a7.JPG'),
  resolvePath('/memories/b8b07275-1668-431c-92da-d582c940a0c7.JPG'),
  resolvePath('/memories/e0618077-191d-4805-b0b2-eeb0b1ca263e.JPG'),
  resolvePath('/memories/e5a59266-912f-4ecf-8ac0-1b8abdcf200c.JPG'),
  resolvePath('/memories/fc90b5e2-bc5b-4ae2-98f4-c14950b61788.JPG'),
];

const TOTAL_PAGES = 5;

const pageVariants = {
  enter: { x: '100%', opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: '-100%', opacity: 0 }
};

const songs = [
  { src: resolvePath('/song.mp3'), cover: resolvePath('/song.jpg') },
  { src: resolvePath('/Les.mp3'), cover: resolvePath('/les.jpeg') }
];

const HAS_WEBGL = detectWebGL();

function App() {
  const [currentPage, setCurrentPage] = useState(0);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const nextPage = () => setCurrentPage(p => Math.min(p + 1, TOTAL_PAGES - 1));
  const prevPage = () => setCurrentPage(p => Math.max(p - 1, 0));

  const nextSong = () => {
    setCurrentSongIndex(prev => (prev + 1) % songs.length);
  };

  const prevSong = () => {
    setCurrentSongIndex(prev => (prev - 1 + songs.length) % songs.length);
  };

  const handleStart = () => {
    // Start music and go to next page
    if (audioRef.current) {
      audioRef.current.play().catch(e => console.log("Audio play:", e));
    }
    nextPage();
  };

  // Auto-play when song changes
  // Auto-play when song changes, but don't reset if already playing correctly
  useEffect(() => {
    if (audioRef.current && currentPage > 0) {
      const newSrc = songs[currentSongIndex].src;
      // Check using getAttribute to avoid absolute/relative path mismatches
      const currentSrc = audioRef.current.getAttribute('src');
      
      if (currentSrc !== newSrc) {
        audioRef.current.src = newSrc;
        audioRef.current.play().catch(console.log);
      } else if (audioRef.current.paused) {
         // Optional: Only resume if we explicitly want to (e.g. initial start)
         // But user said "immer weiter laufen", so if it's paused *and* we clearly just started/navigated, maybe we should play? 
         // Actually, better to NOT force play if user paused it manually, EXCEPT on first start.
         // Let's rely on the first start handler for the initial play.
         // But when switching songs (currentSongIndex changes), we DO want to play.
         // The dependency [currentSongIndex, currentPage] triggers this.
         // If currentSongIndex changed, src changes -> plays.
         // If currentPage changed, src is same -> do nothing (keep playing).
      }
    }
  }, [currentSongIndex, currentPage]);

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Persistent Audio Element */}
      <audio 
        ref={audioRef} 
        src={songs[0].src} // Initial src, but useEffect controls it later
        onEnded={nextSong}
      />
      
      {/* Global Background Effects - 3D wenn möglich, sonst 2D-Canvas */}
      {HAS_WEBGL ? (
        <Suspense fallback={<CanvasBackgroundEffects />}>
          <BackgroundScene />
        </Suspense>
      ) : (
        <CanvasBackgroundEffects />
      )}

      <AnimatePresence mode="wait">
        {currentPage === 0 && (
          <motion.div
            key="start"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: 'absolute', width: '100%' }}
          >
            <StartPage onStart={handleStart} />
          </motion.div>
        )}

        {currentPage === 1 && (
          <motion.div
            key="photos"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: 'absolute', width: '100%', zIndex: 10, top: 0, left: 0 }}
          >
            <PhotosPage
              images={memoryImages}
              currentPage={currentPage}
              totalPages={TOTAL_PAGES}
              onNext={nextPage}
              onPrev={prevPage}
            />
          </motion.div>
        )}

        {currentPage === 2 && (
          <motion.div
            key="vinyl"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: 'absolute', width: '100%' }}
          >
            <VinylPage
              currentPage={currentPage}
              totalPages={TOTAL_PAGES}
              onNext={nextPage}
              onPrev={prevPage}
              audioRef={audioRef}
              currentSong={songs[currentSongIndex]}
              onNextSong={nextSong}
              onPrevSong={prevSong}
            />
          </motion.div>
        )}

        {currentPage === 3 && (
          <motion.div
            key="letter"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: 'absolute', width: '100%' }}
          >
            <LetterPage
              currentPage={currentPage}
              totalPages={TOTAL_PAGES}
              onNext={nextPage}
              onPrev={prevPage}
            />
          </motion.div>
        )}

        {currentPage === 4 && (
          <motion.div
            key="peony"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: 'absolute', width: '100%' }}
          >
            <PeonyPage
              currentPage={currentPage}
              totalPages={TOTAL_PAGES}
              onPrev={prevPage}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
