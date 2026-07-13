/** Anzahl der Scroll-Seiten (1 pro Section). */
export const PAGES = 8;

export const SECTION_IDS = [
  "hero",
  "photos",
  "vinyl",
  "letter",
  "penguins",
  "sarma",
  "globe",
  "finale",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];
