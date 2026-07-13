import type { SectionProps } from '../types';

export const LetterScene = () => (
  <mesh rotation={[0.2, -0.3, 0]}>
    <boxGeometry args={[2, 1.3, 0.08]} />
    <meshStandardMaterial color="#fdf6ec" roughness={0.6} />
  </mesh>
);

export const LetterHtml = ({ onOpenLetter }: SectionProps) => (
  <div className="exp-content" style={{ paddingTop: '12vh' }}>
    <span className="exp-kicker">Kapitel 3</span>
    <h2 className="exp-title">Ein Brief für dich</h2>
    <p className="exp-subtitle">Von mir, für dich — schwarz auf weiß.</p>
    <button className="exp-btn primary" onClick={onOpenLetter}>
      Brief lesen
    </button>
  </div>
);
