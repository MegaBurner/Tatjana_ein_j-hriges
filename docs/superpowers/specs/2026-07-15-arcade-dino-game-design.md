# Arcade-Section: Dino-Runner mit uns beiden

**Datum:** 2026-07-15
**Status:** Autonom abgenommen (Goal-Modus) — Entscheidungen inkl. verworfener Alternativen dokumentiert.

## Ziel

Ein Chrome-Dino-Style Endless-Runner als neue Section der Geschenk-Website:

- Spielfigur = Melih (Pixel-Art-Spritesheet aus `~/Downloads/Gemini_Generated_Image_xzsqz4xzsqz4xzsq.png`).
- Auf der anderen Seite (rechter Bildrand) steht Tatjana und winkt ihn her — sie ist das Ziel, auf das er zuläuft.
- Kakteen = springen, Vögel = ducken (klassische Dino-Mechanik).
- Eigene Section mit einem 3D-Laptop; das Spiel läuft klein auf dem Laptop-Screen (Attract-Mode), Klick öffnet es groß als Fullscreen-Overlay.
- Highscore wird im Repo gespeichert (kein Backend — Seite ist nur für uns zwei).

## Kontext (Ist-Zustand)

- React 19 + Vite 8 + R3F; `SECTIONS`-Array mit je `Scene` (3D) + `Html` (DOM-Overlay), `PAGES = 9`, Deep-Links `?section=N`, Screenshot-Verifikation über `scripts/shot.sh` (+ `?freeze=1`/`?instant=1`).
- Overlay-Pattern existiert: `LetterModal` (lazy, `?letter=1`-Deep-Link, `onOpenLetter`-Prop durch `SectionProps`).
- Spritesheet: 2752×1536 RGBA, aber Alpha komplett opak — Schachbrett-Hintergrund (Grau ~172/~111) ist eingebacken. Frames liegen unregelmäßig (KI-generiert, kein Grid), Text-Labels sind eingebacken. Inhalt: Melih Idle/Walk/Run/Jump/Duck (+ Staubwolken), Vögel gelb/rot (je 6 Flug-Frames), 4 Kaktus-Varianten (klein/mittel/groß/doppel), wiederholbare Bodenkachel, Tatjana (lila Kleid) Idle/Wink/Wave, Herz-Frames.

## Entscheidungen

### 1. Sprite-Pipeline: Python-Skript mit manuell getunten Regionen

`scripts/extract_sprites.py` (PIL + numpy, beides vorhanden):

1. **Clearen:** Flood-Fill vom Bildrand über die beiden Schachbrett-Grautöne (mit Toleranz) → echtes Alpha. Flood-Fill statt globalem Chroma-Key, damit graue Sprite-Innereien (Staubwolken!) erhalten bleiben. Kanten-Feathering + Morphologie gegen KI-Antialiasing-Säume.
2. **Trennen:** Connected Components → Bounding Boxes; nahe Boxen mergen (Staub gehört zum Lauf-Frame, Herzen-Gruppen zusammen). Debug-Overlay-PNG mit nummerierten Boxen zur visuellen Kontrolle (ich lese das Bild selbst und tune die Regionsliste im Skript).
3. **Sortieren:** Manuell gepflegtes Mapping Box→Frame-Name im Skript (deterministisch, committet, re-runnbar). Text-Label-Regionen werden explizit ausgeschlossen.
4. **Export:** Gepackter Atlas `public/game/atlas.png` + `public/game/atlas.json` (Frame-Name → x/y/w/h + Anchor). Ein Bild statt ~40 Einzeldateien.

Frame-Namen: `player/idle_*`, `player/run_*`, `player/jump_*`, `player/duck_*`, `bird/yellow_*`, `bird/red_*`, `cactus/small|medium|large|double`, `ground/tile`, `lady/idle_*`, `lady/wave_*`, `lady/wink_*`, `fx/heart_*`.

_Verworfen:_ Automatische Grid-Zerlegung (Frames sind nicht auf Grid); globaler Chroma-Key (frisst Staubwolken); Einzeldatei-Export (unnötig viele Requests).

### 2. Game-Design: Endless-Runner, Tatjana fest am rechten Rand

- Klassische Dino-Mechanik: Melih läuft links auf fester X-Position, Welt scrollt. Space/↑/Tap = Sprung, ↓/Swipe-down/Halten unten = Ducken. Geschwindigkeit steigt mit Distanz.
- **Der Twist:** Tatjana steht dauerhaft am rechten Bildrand auf eigenem kleinen Boden-Podest (vor dem Spielfeld-Ende, nicht als Hindernis) und winkt (Wave-Loop). Erzählerisch: er läuft immer auf sie zu.
- Meilensteine (alle 500 Punkte): Wink-Animation + Herz-Partikel (3 Herz-Frames) von ihr aus.
- Neuer Highscore beim Game Over: Herz-Regen + „Neuer Rekord!".
- Score = Distanz (wie Chrome-Dino). Game Over bei Kollision → Restart mit Space/Tap.
- Attract-Mode (für den Laptop-Screen): Titelbild mit Melih-Idle-Loop, winkender Tatjana, Highscore-Anzeige und „Klick mich!"-Pulse — kein selbstspielender Demo-Bot (YAGNI).

_Verworfen:_ Level-Modus mit Win-State „er erreicht sie" — romantisch, aber macht Highscore-Semantik kaputt und dupliziert Spielzustände. Die dauerhafte Präsenz am rechten Rand erfüllt die Vorgabe („auf der anderen Seite eine Dame, die mich herwinkt") direkter.

### 3. Engine: Pure-TypeScript-Canvas-2D-Modul, framework-agnostisch

`src/game/` — Klasse `DinoGame(canvas, opts)`, kein React im Kern:

- Feste interne Auflösung (960×270), CSS-skaliert, `imageSmoothingEnabled = false` (Pixel-Look).
- Fixed-Timestep-Update (Akkumulator), rendert mit `requestAnimationFrame`; `start()/stop()/destroy()`-API.
- Atlas-Loader liest `atlas.json` + `atlas.png` einmal (Modul-Cache), beide Instanzen (Laptop-Screen + Overlay) teilen sich das Bild.
- Dateien klein und fokussiert: `DinoGame.ts` (Loop/State), `physics.ts`, `obstacles.ts`, `sprites.ts` (Atlas), `highscore.ts`, `input.ts`.

_Verworfen:_ Phaser o. Ä. (viel zu schwer für einen Runner, Bundle-Size); Spiel in R3F-Ebene rendern (unnötige Kopplung, DOM-Canvas ist trivialer und schneller).

### 4. Section: „arcade" zwischen rayman und finale, Laptop aus Primitiven

- `SECTION_IDS`/`SECTIONS` + neue Section `ArcadeSection.tsx`, `PAGES` 9 → 10. Platzierung nach „rayman" (Games-Thema schließt an) und vor „finale".
- Laptop aus R3F-Primitiven (RoundedBox-Basis + aufgeklapptes Display, Tastatur-Andeutung) — Stil wie der Plattenspieler in `VinylSection`, kein GLB nötig.
- **Spiel auf dem Screen:** Offscreen-Canvas (Attract-Mode) → `THREE.CanvasTexture` auf dem Display-Mesh, `needsUpdate` pro Frame nur bei `sectionVisibility > ε`.
- **Idle-Animation:** Laptop schwebt/bobbt sanft, Display-Glow pulsiert leicht; Entrance über `sectionProgress` (aufklappen beim Reinscrollen: Display-Winkel animiert).
- **Click-Animation:** Hover = Cursor-Pointer + leichtes Scale-Up (wie Vinyl-Tap-Pattern mit `TAP_MAX_MOVEMENT_PX`/Sichtbarkeits-Schwelle); Klick = kurzes „Zoom-Richtung-Kamera"-Feedback, dann öffnet das Fullscreen-Overlay.
- **Overlay:** `ArcadeModal` analog `LetterModal` (lazy, Focus-Trap-Light, ESC/X schließen, `?game=1`-Deep-Link für Sharing + Screenshot-Verifikation). Neue Props `onOpenGame` in `SectionProps` analog `onOpenLetter`. Mobile: Tap = Sprung, Halten/Swipe-down = Ducken + sichtbare Touch-Buttons.

### 5. Highscore: Repo-Seed + localStorage + Dev-Write-Plugin

- `public/game/highscore.json` = `{ "best": 0, "holder": "", "date": "" }` — committet im Repo (die gewünschte „im Repo"-Speicherung; kein Backend, Seite ist statisch auf GitHub Pages).
- Laufzeit: `localStorage["arcade.highscore.v1"]`; effektiver Bestwert = max(Seed, localStorage).
- Kleines Vite-Dev-Plugin (`vite.config.ts`): POST `/__highscore` schreibt im Dev-Server die JSON-Datei → lokal erspielte Rekorde landen wirklich in der Repo-Datei und werden beim nächsten Commit Teil der Historie. In Produktion (GitHub Pages) still deaktiviert, localStorage übernimmt.

_Verworfen:_ Externes Backend/Gist-API (Overkill + Secrets für eine Zwei-Personen-Seite).

### 6. Abnahme: „mehrere Kontrollen"

1. `npm run build` + `npm run lint` grün (Repo-Gate, keine Test-Infra vorhanden — bewusst beibehalten).
2. Headless-Screenshots über `scripts/shot.sh`: `?section=8` (Laptop sichtbar, Screen zeigt Attract-Mode), `?game=1` (Overlay offen, Ready-Screen), Gameplay-Zustand (per Playwright-MCP: Spiel starten, springen, Screenshot), Game-Over-Zustand.
3. Drei unabhängige, non-biased Verifikations-Agents prüfen die Screenshots gegen die Akzeptanzkriterien (nur Bild + Kriterienliste, keine Implementierungsdetails im Prompt).

## Akzeptanzkriterien

1. Sprites: transparenter Hintergrund (kein Schachbrett-Rest), korrekt getrennt/benannt, keine eingebackenen Text-Labels im Atlas.
2. Section „arcade" existiert zwischen rayman und finale; Laptop sichtbar mit laufendem Attract-Mode auf dem Screen; Idle-Bob vorhanden.
3. Klick auf Laptop öffnet Fullscreen-Overlay; `?game=1` tut dasselbe; ESC/X schließt.
4. Spiel: Springen über Kakteen, Ducken unter Vögeln, Kollision → Game Over → Restart; Score zählt; Geschwindigkeit steigt.
5. Tatjana steht rechts und winkt (animiert); Herz-Meilensteine feuern.
6. Highscore überlebt Reload (localStorage) und `public/game/highscore.json` existiert als Repo-Seed; Dev-Plugin schreibt lokal zurück.
7. Build + Lint grün; bestehende Sections unverändert funktionsfähig (Stichprobe per Screenshot hero/finale).
8. Drei unabhängige Agent-Kontrollen bestätigen 1–7 anhand von Screenshots.
