# Design: Verspielte Interaktionen in allen Sections

**Datum:** 2026-07-14 · **Status:** vom Nutzer freigegeben („passt so leg los")

## Ziel

Jede der 8 Sections reagiert auf Klick/Tipp (mobiltauglich, kein Hover nötig) mit einer
kleinen, verspielten Belohnung. Bestehende Interaktionen (Globus-Drag, Vinyl-Player,
Buch-Blättern, Brief-Modal) bleiben unverändert erhalten.

## Nicht-Ziele

- Kein Drag-Handling in weiteren Szenen (nur der Globus bleibt draggable).
- Keine versteckten Botschaften/Easter Eggs (bewusst abgewählt).
- Keine neuen Dependencies, keine neuen Texturen/Assets.

## Interaktionen pro Section

| #   | Section  | Klick/Tipp-Reaktion                                                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0   | Hero     | Klick auf Peonie → Blütenblätter-Puff (instanced, wiederverwendete Ambient-Partikel); Blumen schwingen dezent zum Pointer |
| 1   | Fotobuch | Klick aufs Foto → kurzer Zoom-Pop (Scale-Pulse) des aktuellen Fotos                                                       |
| 2   | Vinyl    | Klick auf Platte → Scratch-Wobble + kurzes Aufdrehen der Rotation; Tonarm hebt sich, wenn Musik pausiert                  |
| 3   | Brief    | Klick auf Trifold → Auf-Wippen, dann bestehendes Modal öffnen (größere Trefferfläche als Button)                          |
| 4   | Pinguine | Klick → beide watscheln zueinander, Kuss + Herzchen-Burst (vorhandene Kuss-Animation aus Runde 3 wird getriggert)         |
| 5   | Sarma    | Klick auf Rolle → Wackeln + ein Dampf-Wölkchen steigt auf                                                                 |
| 6   | Globus   | Drag bleibt; Klick auf Pin → Erinnerungs-Label ploppt mit Herzchen                                                        |
| 7   | Finale   | Klick irgendwo in der Szene → Herz-Konfetti-Burst am Klickpunkt                                                           |

## Technischer Rahmen

- **Events:** R3F-Pointer-Events (`onClick`/`onPointerMove`) auf den Szenen-Meshes;
  Tap = Click auf Touch-Geräten. Kollision mit Scroll-/Drag-Gesten vermeiden:
  Klick-Reaktionen nur bei geringer Pointer-Bewegung (Tap-Erkennung wie beim Globus).
- **Animationen:** ausschließlich Transform-/Material-Animationen in bestehenden
  `useFrame`-Loops (Spring-Puls-Helfer pro Szene, kleine gemeinsame Utility erst bei
  echter Wiederholung — KISS/YAGNI).
- **Partikel:** nur vorhandene Bausteine (Herzchen aus PenguinsSection,
  Konfetti/Ambient-Partikel) wiederverwenden; gleichzeitige Bursts gedeckelt
  (max. 3 aktiv), damit der 2019er-MBP und ältere Handys nicht einbrechen.
- **Cursor:** `pointer`-Cursor auf interaktiven Meshes (Desktop-Affordance).
- **Verifikation:** build + lint + sequenzielle Headless-Chrome-Shots (kein Playwright);
  Interaktions-Verhalten wird zusätzlich manuell vom Nutzer geprüft, da statische
  Shots Klick-Reaktionen nur begrenzt zeigen.

## Abhängigkeit

Umsetzung erst NACH dem Fix des Titel-Band-Layout-Drifts (separater Fund vom
2026-07-14, siehe Commit-Historie), damit Trefferflächen und Layout-Feinjustierung
nicht gegen ein falsches Raster gebaut werden.
