import { useEffect, useState } from 'react';
import { requestScrollTarget, subscribeScroll } from './scrollBus';
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
    if (max <= 0) return;
    // Kein `el.scrollTo({behavior:'smooth'})` — der native Smooth-Scroll des
    // Browsers würde parallel zu SnapControllers Easing-Schreibzugriffen an
    // `el.scrollTop` schreiben. Stattdessen wird nur das Ziel gemeldet;
    // SnapController fährt es als alleiniger Schreiber an (siehe scrollBus).
    requestScrollTarget((index * max) / (CHAPTER_COUNT - 1));
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
