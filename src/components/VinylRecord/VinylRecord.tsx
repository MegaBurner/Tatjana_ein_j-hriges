import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, SkipBack, SkipForward } from 'lucide-react';
import './VinylRecord.css';

interface VinylRecordProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  coverImage?: string;
  onNextSong?: () => void;
  onPrevSong?: () => void;
}

const VinylRecord = ({ audioRef, coverImage, onNextSong, onPrevSong }: VinylRecordProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);

  // Sync state with audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    
    // Sync initial state
    setIsPlaying(!audio.paused);
    setIsMuted(audio.muted);
    setVolume(audio.volume);
    
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [audioRef]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleRewind = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
        audioRef.current.muted = false;
      }
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="vinyl-wrapper">
      {/* Vinyl Disc */}
      <div 
        className={`vinyl-record ${isPlaying ? 'spinning' : ''}`}
      >
        <div className="vinyl-label">
          {coverImage && (
            <img 
              src={coverImage} 
              alt="Album Cover" 
              className="vinyl-cover-img"
              style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%', 
                height: '100%', 
                objectFit: 'cover', 
                borderRadius: '50%',
                zIndex: 1
              }}
            />
          )}
          <div className="vinyl-hole" style={{ zIndex: 2, position: 'relative' }} />
        </div>
      </div>

      {/* Audio Controls */}
      <div className="audio-controls">
        <button onClick={handleRewind} className="control-btn" aria-label="Rewind">
          <RotateCcw size={20} />
        </button>
        
        {onPrevSong && (
          <button onClick={onPrevSong} className="control-btn" aria-label="Previous Song">
            <SkipBack size={20} />
          </button>
        )}

        <button onClick={togglePlay} className="control-btn play-btn" aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>

        {onNextSong && (
          <button onClick={onNextSong} className="control-btn" aria-label="Next Song">
            <SkipForward size={20} />
          </button>
        )}

        <button onClick={toggleMute} className="control-btn" aria-label={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="volume-slider"
          aria-label="Volume"
        />
      </div>
    </div>
  );
};

export default VinylRecord;
