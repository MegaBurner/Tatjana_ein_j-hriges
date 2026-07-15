/** Anzahl der Scroll-Seiten (1 pro Section). */
export const PAGES = 10;

export const SECTION_IDS = [
  "hero",
  "photos",
  "vinyl",
  "letter",
  "penguins",
  "sarma",
  "globe",
  "rayman",
  "arcade",
  "finale",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];
