import type { ComponentType } from "react";
import type { SectionProps } from "../types";
import { HeroScene, HeroHtml } from "./HeroSection";
import { PhotosScene, PhotosHtml } from "./PhotosSection";
import { VinylScene, VinylHtml } from "./VinylSection";
import { LetterScene, LetterHtml } from "./LetterSection";
import { PenguinsScene, PenguinsHtml } from "./PenguinsSection";
import { SarmaScene, SarmaHtml } from "./SarmaSection";
import { GlobeScene, GlobeHtml } from "./GlobeSection";
import { RaymanScene, RaymanHtml } from "./RaymanSection";
import { ArcadeScene, ArcadeHtml } from "./ArcadeSection";
import { FinaleScene, FinaleHtml } from "./FinaleSection";

export interface SectionDef {
  id: string;
  /** 3D-Inhalt — wird innerhalb von <Scroll> bei y = -index * viewport.height gerendert */
  Scene: ComponentType<SectionProps>;
  /** DOM-Overlay — wird innerhalb von <Scroll html> in einem 100vh-Container gerendert */
  Html: ComponentType<SectionProps>;
}

export const SECTIONS: SectionDef[] = [
  { id: "hero", Scene: HeroScene, Html: HeroHtml },
  { id: "photos", Scene: PhotosScene, Html: PhotosHtml },
  { id: "vinyl", Scene: VinylScene, Html: VinylHtml },
  { id: "letter", Scene: LetterScene, Html: LetterHtml },
  { id: "penguins", Scene: PenguinsScene, Html: PenguinsHtml },
  { id: "sarma", Scene: SarmaScene, Html: SarmaHtml },
  { id: "globe", Scene: GlobeScene, Html: GlobeHtml },
  { id: "rayman", Scene: RaymanScene, Html: RaymanHtml },
  { id: "arcade", Scene: ArcadeScene, Html: ArcadeHtml },
  { id: "finale", Scene: FinaleScene, Html: FinaleHtml },
];
