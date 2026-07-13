import type { SectionProps } from '../types';

export const VinylScene = () => (
  <mesh rotation={[Math.PI / 2.4, 0, 0]}>
    <cylinderGeometry args={[1.3, 1.3, 0.05, 64]} />
    <meshStandardMaterial color="#141414" roughness={0.4} />
  </mesh>
);

export const VinylHtml = ({ audioRef, onNextSong, onPrevSong, currentSong }: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: '8vh' }}>
    <span className="exp-kicker">Kapitel 2</span>
    <h2 className="exp-title">Unsere Songs</h2>
    <p className="exp-subtitle">{currentSong.title}</p>
    <div style={{ display: 'flex', gap: '0.75rem' }}>
      <button className="exp-btn" onClick={onPrevSong}>‹</button>
      <button
        className="exp-btn primary"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
      >
        Play / Pause
      </button>
      <button className="exp-btn" onClick={onNextSong}>›</button>
    </div>
  </div>
);
