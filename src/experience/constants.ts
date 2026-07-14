/** Anzahl der Scroll-Seiten (1 pro Section). */
export const PAGES = 9;

export const SECTION_IDS = [
  "hero",
  "photos",
  "vinyl",
  "letter",
  "penguins",
  "sarma",
  "globe",
  "rayman",
  "finale",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];
