import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Music, VolumeX } from "lucide-react";
import { detectWebGL } from "./three/hooks/useWebGL";
import PDFModal from "./components/PDFModal/PDFModal";
import DotRail from "./experience/DotRail";
import "./experience/experience.css";
import type { Song } from "./experience/types";

const Experience = lazy(() => import("./experience/Experience"));
const LegacyApp = lazy(() => import("./LegacyApp"));

const resolvePath = (path: string) => {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
};

const songs: Song[] = [
  {
    src: resolvePath("/song.mp3"),
    cover: resolvePath("/song.jpg"),
    title: "Senidah — Delija",
  },
  {
    src: resolvePath("/Les.mp3"),
    cover: resolvePath("/les.jpeg"),
    title: "Childish Gambino — L.E.S.",
  },
];

const HAS_WEBGL = detectWebGL();

function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [songIndex, setSongIndex] = useState(0);
  const [isMusicStarted, setIsMusicStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  // ?nointro=1 überspringt das Intro-Overlay (Deep-Links & Screenshot-Verifikation)
  const [introDone, setIntroDone] = useState(() =>
    new URLSearchParams(window.location.search).has("nointro"),
  );

  const nextSong = () => setSongIndex((prev) => (prev + 1) % songs.length);
  const prevSong = () =>
    setSongIndex((prev) => (prev - 1 + songs.length) % songs.length);

  const startMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsMusicStarted(true);
    void audio.play().catch(() => undefined);
  };

  // Browser blockieren Autoplay ohne Nutzer-Geste (NotAllowedError) — daher
  // startet die Musik erst über den expliziten Klick im Intro-Overlay.
  const handleStartWithMusic = () => {
    startMusic();
    setIntroDone(true);
  };

  const handleSkipMusic = () => {
    setIntroDone(true);
  };

  const toggleMusic = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setIsMusicStarted(true);
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  // Play/Pause-Status vom Audio-Element spiegeln
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  // Songwechsel: neue Quelle setzen und weiterspielen, wenn Musik läuft
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const newSrc = songs[songIndex].src;
    if (audio.getAttribute("src") !== newSrc) {
      const wasPlaying = !audio.paused;
      audio.src = newSrc;
      if (wasPlaying) {
        void audio.play().catch(() => undefined);
      }
    }
  }, [songIndex]);

  if (!HAS_WEBGL) {
    return (
      <Suspense fallback={null}>
        <LegacyApp />
      </Suspense>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <audio ref={audioRef} src={songs[0].src} onEnded={nextSong} />

      <Suspense
        fallback={
          <div className="exp-loading">
            <span className="exp-loading-heart">❤️</span>
            <span>Für Tatjana…</span>
          </div>
        }
      >
        <Experience
          audioRef={audioRef}
          currentSong={songs[songIndex]}
          isPlaying={isPlaying}
          isMusicStarted={isMusicStarted}
          onStartMusic={startMusic}
          onNextSong={nextSong}
          onPrevSong={prevSong}
          onOpenLetter={() => setLetterOpen(true)}
        />
      </Suspense>

      {/* Persistenter Musik-Toggle */}
      <button
        className="exp-music-toggle"
        onClick={toggleMusic}
        aria-label={isPlaying ? "Musik pausieren" : "Musik abspielen"}
      >
        {isPlaying ? <Music size={18} /> : <VolumeX size={18} />}
      </button>

      <DotRail />

      <PDFModal
        isOpen={letterOpen}
        onClose={() => setLetterOpen(false)}
        pdfUrl={resolvePath("/notiz.pdf")}
      />

      <AnimatePresence>
        {!introDone && (
          <motion.div
            className="exp-intro"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={{ duration: 0.6 }}
          >
            <div className="exp-intro-card">
              <h1 className="exp-intro-title">Für Tatjana ♥</h1>
              <p className="exp-intro-text">
                Eine kleine Reise durch unser Jahr
              </p>
              <div className="exp-intro-actions">
                <button
                  type="button"
                  className="exp-btn primary"
                  onClick={handleStartWithMusic}
                  autoFocus
                >
                  Mit Musik starten
                </button>
                <button
                  type="button"
                  className="exp-intro-skip"
                  onClick={handleSkipMusic}
                >
                  Ohne Musik
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
