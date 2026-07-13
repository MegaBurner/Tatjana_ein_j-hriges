import { useEffect, useState } from 'react';
import { subscribeScroll } from './scrollBus';
import type { ScrollSnapshot } from './scrollBus';

const CHAPTER_LABELS = [
  'Start',
  'Fotos',
  'Songs',
  'Brief',
  'Pinguine',
  'Sarma',
  'Finale',
] as const;
const CHAPTER_COUNT = CHAPTER_LABELS.length;

/**
 * Vertikale Kapitel-Navigation, fixiert rechts mittig — außerhalb des
 * Canvas gerendert. Zeigt 7 Punkte (1 pro Section), hebt den aktiven
 * hervor und erlaubt per Klick direkt zur Section zu springen.
 */
function DotRail() {
  const [snapshot, setSnapshot] = useState<ScrollSnapshot>({ sectionIndex: 0, el: null });

  useEffect(() => subscribeScroll(setSnapshot), []);

  const handleDotClick = (index: number) => {
    const el = snapshot.el;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: (index * max) / (CHAPTER_COUNT - 1), behavior: 'smooth' });
  };

  return (
    <nav className="exp-dotrail" aria-label="Kapitel-Navigation">
      {CHAPTER_LABELS.map((label, i) => {
        const isActive = i === snapshot.sectionIndex;
        const title = `${label} — Kapitel ${i + 1} von ${CHAPTER_COUNT}`;
        return (
          <button
            key={label}
            type="button"
            className={isActive ? 'exp-dot active' : 'exp-dot'}
            aria-label={title}
            title={title}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => handleDotClick(i)}
          >
            <span className="exp-dot-mark" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

export default DotRail;
