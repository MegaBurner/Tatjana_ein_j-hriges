import type { RefObject } from 'react';

export interface Song {
  src: string;
  cover: string;
  title: string;
}

/** Props, die jede Section (Scene + Html) erhält. */
export interface SectionProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  currentSong: Song;
  isMusicStarted: boolean;
  onStartMusic: () => void;
  onNextSong: () => void;
  onPrevSong: () => void;
  onOpenLetter: () => void;
  index: number;
}

export type ExperienceProps = Omit<SectionProps, 'index'>;
