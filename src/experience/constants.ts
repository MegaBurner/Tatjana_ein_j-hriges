/** Anzahl der Scroll-Seiten (1 pro Section). */
export const PAGES = 7;

export const SECTION_IDS = [
  'hero',
  'photos',
  'vinyl',
  'letter',
  'penguins',
  'sarma',
  'finale',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];
