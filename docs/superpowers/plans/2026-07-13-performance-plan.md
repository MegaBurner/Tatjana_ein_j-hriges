# Performance-Plan „Extreme Optimierung" + Feedback-Runde 2

**Stand:** 2026-07-13, Branch `feature/feedback-round`
**Verifikation ohne Playwright:** Headless-Chrome-Einzelshots (`scratchpad/shot.sh` + Deep-Links `?section=N&nointro=1`), `tsc`/`lint`, Größenmessungen.

## Baseline (gemessen)

| Metrik                                          | Ist                                              |
| ----------------------------------------------- | ------------------------------------------------ |
| three/R3F-Vendor-Chunk                          | 864 kB (gzip ~231 kB)                            |
| Entry-Chunk (React, framer-motion, lucide, App) | 312 kB (gzip ~110 kB)                            |
| dist gesamt                                     | 42 MB (27 MB Alt-Fotos für Legacy, ~11 MB Audio) |
| Buch-Fotos                                      | 2,4 MB (bereits optimiert)                       |
| Cover (song.jpg, les.jpeg)                      | unkomprimierte Originale                         |
| Draw-Calls Hero                                 | ~120+ (16 Blumen × Einzel-Meshes)                |
| Leaf-useFrame                                   | läuft auch für unsichtbare Sections              |

## Ziele (messbar)

1. Hero-Draw-Calls < 25 → Blumen als Instanzen (kombiniert mit Feedback „Pfingstrosen")
2. Keine Per-Frame-Arbeit in unsichtbaren Sections (Early-Return-Gating in allen Leaf-useFrames)
3. dist < 16 MB → Legacy-Fallback nutzt web-Fotos; Original-JPGs raus aus public/
4. Cover-Bilder < 100 kB gesamt (sips-Kompression)
5. Entry-Chunk-Aufteilung: react-vendor / three-vendor / App (Cache-Stabilität)
6. Buch-Texturen laden erst bei Annäherung an Section 1 (nicht beim App-Start)
7. DPR-Cap 1,75; Kugel-Segmente reduziert (24→12/16 wo unsichtbar)

## Arbeitspakete

- **A (erledigt):** Deep-Links `?section=N`, `?nointro=1`; shot.sh; Snap-Glide (zeitbasiert, Ease-in-out, Fremd-Writer-Erkennung); Sarma-Kippung 0.62 rad; Pinguin-Abstände (kein Clipping)
- **B — Agent P (Perf):** Ziele 1-7; Hero-Rebuild als Pfingstrosen (gefüllte, mehrlagige Blüten) in InstancedMeshes
- **C — Agent V (Visual):** „Roter Faden"-Band durch alle Sections (TubeGeometry entlang CatmullRom-Kurve, scrollt mit); Pinguine schöner (rundere Silhouette, Wangen, Glanzlichter, weicher Schatten); Brief-Präsentation: notiz.pdf-Seiten via `pdftoppm` als JPEGs vorrendern, PDFModal durch stilvolles Papier-Modal ersetzen (Serif, Creme, Gold-Akzente, Blätter-Navigation) statt Browser-PDF-Chrome
- **D (erledigt durch unterbrochenen Agent, reviewt):** Intro-Gate „Mit Musik starten" (Autoplay-Policy), manuelles Blättern im Fotobuch (bookStore + Buttons)

## Nicht-Ziele

- Kein Postprocessing, keine neuen Dependencies, kein Server-Rendering
- Audio-Kompression (Songs bleiben unangetastet — Qualität ist Absicht)
