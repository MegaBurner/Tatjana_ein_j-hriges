# Arcade-Dino-Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome-Dino-Style Endless-Runner (Spielfigur = Melih, Tatjana winkt am rechten Rand) als neue „arcade"-Section mit 3D-Laptop, Fullscreen-Overlay und Repo-Highscore.

**Architecture:** Python-Pipeline extrahiert Sprites aus dem KI-Spritesheet in einen gepackten Atlas (`public/game/`). Framework-agnostische Canvas-2D-Engine in `src/game/`. R3F-Section rendert das Spiel als CanvasTexture auf einem Primitiven-Laptop; Klick öffnet ein DOM-Overlay (`ArcadeModal`, Pattern von `LetterModal`).

**Tech Stack:** React 19, Vite 8, R3F/drei, Three.js, Canvas 2D, Python 3 (PIL+numpy, nur Build-Zeit). Keine neuen Runtime-Dependencies.

## Global Constraints

- TypeScript auf `~5.9.3` gepinnt; keine neuen npm-Dependencies.
- Asset-URLs immer über `import.meta.env.BASE_URL` (GitHub-Pages-Base `/Tatjana_ein_j-hriges/`).
- UI-Texte Deutsch; Code-Kommentare Deutsch (Repo-Konvention), Commits Englisch (Conventional Commits).
- Verifikations-Gate: `npm run build` + `npm run lint` + `scripts/shot.sh`-Screenshots (keine Test-Infra — bewusst).
- Screenshot-Determinismus: `?freeze=1` muss auch Game-/Attract-Canvas einfrieren (ein Frame rendern, kein rAF-Loop).
- Dateien klein halten (<400 Zeilen), Immutability bevorzugen, frühe Returns.
- Section-Reihenfolge: „arcade" zwischen „rayman" (Index 7) und „finale"; arcade = Index 8, finale = Index 9, `PAGES = 10`.

---

### Task 1: Sprite-Pipeline (clearen, trennen, sortieren, Atlas)

**Files:**

- Create: `scripts/extract_sprites.py`
- Create: `art/dino-spritesheet.png` (Kopie der Quelle aus Downloads, committet für Reproduzierbarkeit)
- Create (generiert): `public/game/atlas.png`, `public/game/atlas.json`
- Debug (nicht committet): Scratchpad `sprite_debug.png` mit nummerierten Boxen

**Interfaces:**

- Produces: `atlas.json` = `{ "size": {"w": int, "h": int}, "frames": { "<name>": {"x":int,"y":int,"w":int,"h":int} } }`
- Frame-Namen: `player/idle_0..n`, `player/run_0..n`, `player/jump_0..n`, `player/duck_0..n`, `bird/yellow_0..5`, `bird/red_0..5`, `cactus/small`, `cactus/medium`, `cactus/large`, `cactus/double`, `ground/tile`, `lady/idle_0..n`, `lady/wave_0..n`, `lady/wink_0..n`, `fx/heart_0..2`
- Anchor-Konvention: alle Frames werden im Spiel bottom-center gezeichnet (kein Anchor im JSON nötig).

- [ ] **Step 1: Quelle ins Repo kopieren**

```bash
mkdir -p art && cp "/Users/melihcosgun/Downloads/Gemini_Generated_Image_xzsqz4xzsqz4xzsq.png" art/dino-spritesheet.png
```

- [ ] **Step 2: Extraktions-Skript schreiben**

Kern-Algorithmus (`scripts/extract_sprites.py`):

```python
#!/usr/bin/env python3
"""Extrahiert benannte Sprite-Frames aus dem KI-Spritesheet in einen Atlas.

Pipeline: (1) Checkerboard-Hintergrund per BFS-Flood-Fill vom Rand entfernen
(nur Pixel nahe der beiden Grautöne werden geflutet — graue Staubwolken im
Sprite-Inneren bleiben erhalten), (2) Connected Components -> Bounding-Boxen,
nahe Boxen mergen, (3) manuell gepflegtes REGION-Mapping benennt die Boxen,
(4) Frames in Zeilen-Atlas packen, atlas.png + atlas.json schreiben.
Debug: --debug schreibt Overlay mit nummerierten Boxen.
"""
import numpy as np
from PIL import Image
from collections import deque

BG_COLORS = [(172, 172, 172), (111, 111, 111)]
BG_TOL = 26          # Toleranz gegen KI-Antialiasing an Kachelkanten
MERGE_GAP = 18       # px: Boxen näher als das werden gemerged (Staub, Herzen)
MIN_AREA = 900       # Kleinstteile (Antialiasing-Reste) verwerfen

def remove_background(rgba: np.ndarray) -> np.ndarray: ...
def find_components(alpha: np.ndarray) -> list[tuple[int,int,int,int]]: ...
def merge_boxes(boxes, gap=MERGE_GAP): ...
# REGIONS: name -> (x0, y0, x1, y1) — wird anhand des Debug-Overlays getuned;
# Boxen, deren Zentrum in keiner Region liegt (Text-Labels!), fliegen raus.
```

Flood-Fill: BFS von allen Randpixeln, besucht nur Pixel mit `min(dist zu BG_COLORS) <= BG_TOL`; besuchte Pixel → Alpha 0. Danach 1px-Erosion der Alpha-Kante gegen Säume.

- [ ] **Step 3: Debug-Lauf + Regionen tunen (iterativ)**

```bash
python3 scripts/extract_sprites.py --debug
```

Debug-Overlay selbst ansehen (Read auf PNG), REGIONS-Tabelle im Skript anpassen, bis: keine Text-Labels enthalten, Staub am Lauf-Frame hängt, Herzen als 3 Einzelframes, Bodenkachel als eine lange Box. Erwartung am Ende: Skript druckt `OK: <n> frames -> public/game/atlas.png (WxH)` und Frame-Liste.

- [ ] **Step 4: Atlas visuell verifizieren**

`public/game/atlas.png` per Read ansehen: transparenter Hintergrund (kein Schachbrett), Frames sauber getrennt. `python3 -c` Check: Alpha-Extrema (0, 255) und alle erwarteten Frame-Namen im JSON.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract_sprites.py art/dino-spritesheet.png public/game/atlas.png public/game/atlas.json
git commit -m "feat: sprite extraction pipeline + packed game atlas"
```

---

### Task 2: Atlas-Loader + Highscore-Modul + Vite-Dev-Plugin

**Files:**

- Create: `src/game/sprites.ts`, `src/game/highscore.ts`
- Create: `public/game/highscore.json`
- Modify: `vite.config.ts` (Dev-Plugin)

**Interfaces:**

- Produces `sprites.ts`:
  - `interface AtlasFrame { x: number; y: number; w: number; h: number }`
  - `interface Atlas { image: HTMLImageElement; frames: Record<string, AtlasFrame> }`
  - `loadAtlas(): Promise<Atlas>` (Modul-Cache: mehrfacher Aufruf teilt Promise)
  - `frameSeq(atlas: Atlas, prefix: string): AtlasFrame[]` (sortierte `prefix_0..n`)
  - `drawFrame(ctx, atlas, frame: AtlasFrame, x: number, groundY: number, scale: number, flipX?: boolean)` — bottom-center-Anchor
- Produces `highscore.ts`:
  - `loadHighscore(): Promise<number>` — max(Repo-Seed via fetch, localStorage)
  - `submitScore(score: number): number` — schreibt localStorage, gibt neuen Bestwert zurück; im Dev zusätzlich `void fetch('/__highscore', {method:'POST', ...})`
  - localStorage-Key: `arcade.highscore.v1`
- Produces `highscore.json`: `{ "best": 0, "holder": "", "date": "" }`

- [ ] **Step 1: `highscore.json` Seed anlegen** (Inhalt exakt wie oben)
- [ ] **Step 2: `sprites.ts` implementieren** — fetch `${import.meta.env.BASE_URL}game/atlas.json`, Image mit `${...}game/atlas.png`, `decode()` abwarten.
- [ ] **Step 3: `highscore.ts` implementieren** — Fehlerpfade: fetch-Fehler ⇒ Seed 0; localStorage-Exceptions gefangen (Safari private mode).
- [ ] **Step 4: Vite-Plugin `highscoreDevWriter` in `vite.config.ts`** — `configureServer`: POST `/__highscore` mit Body `{best:number}` → validieren (finite, >0, integer) → `public/game/highscore.json` schreiben (`holder: "local"`, `date: ISO`). Nur Dev (Plugin wirkt ohnehin nur im Dev-Server).
- [ ] **Step 5: Verifikation** — `npm run build` grün; `npm run lint` grün. Dev-Plugin: `npm run dev` + `curl -X POST -d '{"best":42}' localhost:PORT/__highscore` ⇒ Datei enthält 42; danach Seed zurück auf 0 setzen.
- [ ] **Step 6: Commit** — `feat: game atlas loader + repo-seeded highscore with dev write-back`

---

### Task 3: Game-Engine (DinoGame + AttractScreen)

**Files:**

- Create: `src/game/DinoGame.ts` (Loop, Zustände, Rendering)
- Create: `src/game/world.ts` (Physik-/Spawn-Konstanten, Obstacle-Logik, Kollision — pure Funktionen)
- Create: `src/game/attract.ts` (`AttractScreen`)

**Interfaces:**

- Consumes: `loadAtlas`, `frameSeq`, `drawFrame`, `loadHighscore`, `submitScore`
- Produces `DinoGame.ts`:
  - `type GamePhase = 'ready' | 'running' | 'gameover'`
  - `class DinoGame { constructor(canvas: HTMLCanvasElement, atlas: Atlas); start(): void; stop(): void; destroy(): void; jump(): void; duckOn(): void; duckOff(): void; restartOrJump(): void }`
  - Keyboard bindet DinoGame selbst an `window` (Space/ArrowUp = jump/restart, ArrowDown = duck); `destroy()` räumt Listener ab.
- Produces `attract.ts`: `class AttractScreen { constructor(canvas, atlas); start(): void; stop(): void }` — Titelscreen: Melih-Idle-Loop links, Tatjana-Wave rechts, Titel „Lauf zu ihr!", Highscore-Zeile, pulsierendes „Klick mich!".
- Produces `world.ts` (von DinoGame konsumiert):
  - `const VIEW_W = 960, VIEW_H = 270, GROUND_Y = 232`
  - `const GRAVITY = 2400, JUMP_VELOCITY = -830`
  - `const BASE_SPEED = 300, MAX_SPEED = 620, ACCEL = 7` (px/s bzw. px/s²)
  - `interface Obstacle { kind: 'cactus'|'bird'; frame: string; x: number; y: number; w: number; h: number; animFrames?: string[] }`
  - `spawnObstacle(speed: number, rng: () => number): Obstacle`
  - `hitTest(player: Rect, obs: Obstacle): boolean` (AABB, beide Boxen auf 72 % geschrumpft — verzeihend)

**Verhalten (verbindlich):**

- Fixed-Timestep 1/120 s Akkumulator, Render per rAF; `?freeze=1` (URLSearchParams) ⇒ genau ein Frame rendern, kein Loop.
- Score = Distanz/10, Anzeige 5-stellig wie Chrome-Dino; Meilenstein alle 500 ⇒ Tatjana-Wink + 5 Herz-Partikel.
- Vögel: 2 Flughöhen — Kopfhöhe (ducken!) und hoch (durchlaufen/springen); Kakteen 4 Varianten aus Atlas.
- Tatjana: fester Hintergrund-Layer rechts (Scale 0.8, Baseline `GROUND_Y - 22`, eigenes Kachel-Podest), Wave-Loop; kein Kollisionsobjekt.
- Boden: `ground/tile` horizontal gekachelt, Offset `-(distance % tileW)`.
- Game Over: „Game Over — Space/Tippen für Restart"; bei neuem Rekord „Neuer Rekord!" + Herz-Regen (12 Partikel).
- Duck ändert Hitbox auf Duck-Frame-Maße; Sprung-Frames in der Luft, Run-Zyklus (Staub-Frames) am Boden.

- [ ] **Step 1: `world.ts` implementieren** (pure, kein DOM)
- [ ] **Step 2: Logik-Smoke-Check ohne Browser**

```bash
node --input-type=module -e "
import {spawnObstacle, hitTest, GROUND_Y} from './src/game/world.ts';
" 2>/dev/null || npx tsx -e "import {spawnObstacle,hitTest} from './src/game/world.ts'; let r=0.42; const o=spawnObstacle(400,()=>((r=(r*9301+49297)%233280)/233280)); console.log('spawn ok', o.kind, o.x>0); console.log('hit', hitTest({x:o.x,y:o.y,w:o.w,h:o.h}, o)===true); console.log('miss', hitTest({x:0,y:0,w:10,h:10}, o)===false);"
```

Erwartung: `spawn ok … true`, `hit true`, `miss true`.

- [ ] **Step 3: `DinoGame.ts` implementieren** (Phasen ready/running/gameover, Input, Partikel, HUD)
- [ ] **Step 4: `attract.ts` implementieren**
- [ ] **Step 5: Build + Lint** — beide grün.
- [ ] **Step 6: Commit** — `feat: canvas dino-runner engine with lady milestone + attract mode`

---

### Task 4: ArcadeModal (Fullscreen-Overlay) + App-Integration

**Files:**

- Create: `src/components/ArcadeModal/ArcadeModal.tsx` (+ `ArcadeModal.css`)
- Modify: `src/App.tsx` (State `gameOpen`, `?game=1`-Deep-Link, `onOpenGame`-Prop, lazy `<ArcadeModal>`)
- Modify: `src/experience/types.ts` (`onOpenGame: () => void` in `SectionProps`)

**Interfaces:**

- Produces: `ArcadeModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void })`
- Consumes: `DinoGame`, `loadAtlas`, `loadHighscore`
- Overlay: dunkler Backdrop, zentrierter Canvas (`aspect-ratio: 960/270`, max 92vw), `image-rendering: pixelated`, X-Button + ESC schließt, Touch-Buttons „↑ Springen" / „↓ Ducken" nur bei `(pointer: coarse)`, Hinweiszeile mit Steuerung.
- Lifecycle: Mount bei `isOpen` ⇒ Atlas laden ⇒ `new DinoGame(...).start()`; Unmount/Close ⇒ `destroy()`.

- [ ] **Step 1: Modal + CSS implementieren** (Pattern/Klassenstil an `LetterModal` orientieren)
- [ ] **Step 2: App.tsx verdrahten** — exakt wie `letterOpen`/`?letter=1`-Pattern (Zeilen ~12, ~40, ~143, ~159); `onOpenGame` durch `ExperienceProps` reichen.
- [ ] **Step 3: Build + Lint grün**
- [ ] **Step 4: Manuelle Verifikation im Dev-Server** — `npm run dev`; `?game=1` öffnet Overlay; Space startet; Screenshot via shot.sh vom Ready-Screen.
- [ ] **Step 5: Commit** — `feat: fullscreen arcade modal with ?game=1 deep link`

---

### Task 5: ArcadeSection (3D-Laptop) + Section-Registrierung

**Files:**

- Create: `src/experience/sections/ArcadeSection.tsx`
- Modify: `src/experience/constants.ts` (`PAGES = 10`, `"arcade"` in `SECTION_IDS` vor `"finale"`)
- Modify: `src/experience/sections/index.ts` (Import + Eintrag vor finale)
- Modify: alle `Record<SectionId, …>`-Stellen (per `rg "SectionId" src` finden — z. B. DotRail-Labels)
- Prüfen: `src/experience/preloadAssets.ts` / `IdlePreloader.tsx` (Atlas ggf. vorladen), `SnapController.tsx` (nutzt PAGES korrekt?)

**Interfaces:**

- Produces: `ArcadeScene`, `ArcadeHtml` (`SectionProps`-Signatur wie alle Sections)
- Laptop: RoundedBox-Basis (Tastaturfläche) + per `sectionProgress` aufklappendes Display (rotation.x von geschlossen −1.45 rad → offen −0.35 rad), Display-Mesh mit `THREE.CanvasTexture` eines Offscreen-Canvas (960×270), auf dem `AttractScreen` läuft.
- CanvasTexture: `needsUpdate = true` pro useFrame nur bei `sectionVisibility(scroll, index) > 0.005`.
- Idle: sanftes Bobbing (`sin(t) * 0.03`) + leichte Y-Rotation; Hover: Cursor pointer + Scale 1.0→1.04 (damp); Klick (`event.delta <= 8`, Sichtbarkeit ≥ 0.3 — Pattern aus VinylSection): kurzer Scale-Punch + `onOpenGame()`.
- Html-Overlay: Kicker „Kapitel 8", Titel „Lauf zu ihr!", Subtitle + Button „Spiel starten" (ruft `onOpenGame`).

- [ ] **Step 1: constants + index.ts + SectionId-Records aktualisieren** (Build zeigt fehlende Stellen)
- [ ] **Step 2: ArcadeSection implementieren**
- [ ] **Step 3: Build + Lint grün**
- [ ] **Step 4: Screenshots** — `scripts/shot.sh "http://localhost:5173/Tatjana_ein_j-hriges/?section=8" /tmp/.../arcade.png` ⇒ Laptop offen, Attract-Screen sichtbar (Sprites erkennbar); `?section=9` ⇒ finale unverändert.
- [ ] **Step 5: Commit** — `feat: arcade section with 3d laptop running the game on screen`

---

### Task 6: Abnahme (mehrere Kontrollen) + Aufräumen

**Files:**

- Modify (falls nötig): Fixes aus Kontroll-Feedback

- [ ] **Step 1: Gate** — `npm run build` + `npm run lint` grün.
- [ ] **Step 2: Screenshot-Serie** (Dev-Server): Section-Ansicht (`?section=8`), Overlay ready (`?game=1&freeze=1`), Gameplay + Game Over (Playwright-MCP: navigieren, Space, springen, Kollision abwarten, Screenshots), Hero + Finale als Regressions-Stichprobe.
- [ ] **Step 3: Drei unabhängige non-biased Agents** — jeder bekommt NUR Screenshots + Akzeptanzkriterien 1–7 aus dem Spec (keine Implementierungsdetails, keine Erwartungshaltung „es funktioniert"), Auftrag: PASS/FAIL je Kriterium mit Begründung. Bei FAIL: fixen, neue Screenshots, erneut prüfen bis 3× PASS.
- [ ] **Step 4: Memory/Docs** — CREDITS.md ergänzen (eigenes KI-Spritesheet), Spec-Status aktualisieren.
- [ ] **Step 5: Finaler Commit** — `feat: dino-runner arcade game section (sprites, engine, laptop, highscore)`
