# Design: Three.js-Overhaul „Vinyl Love Letter"

**Datum:** 2026-07-12
**Status:** Genehmigt (Umfang: Hintergrund + Vinyl in 3D; Foto-Galerie bleibt 2D)

## Ziel

Die bestehende Jahrestags-Website (React 19 + Vite + Framer Motion, 5 Seiten) erhält
einen visuellen Overhaul: ein Three.js-basierter 3D-Partikel-Hintergrund, eine echte
3D-Vinyl-Schallplatte sowie eine Design-Politur des Lavendel/Rosa-Themas. Alle
Dependencies werden auf die neuesten Major-Versionen gehoben und das derzeit tote
Tailwind-Setup wird repariert.

## Ausgangslage (Befunde)

1. **Tailwind v4 ist installiert, aber nicht angeschlossen:** keine PostCSS-Config,
   `index.css` nutzt v3-Direktiven (`@tailwind base` etc.). Tailwind-Klassen im
   JSX (z.B. `overflow-hidden relative` in `App.tsx`) sind wirkungslos. Das Styling
   lebt vollständig in den Komponenten-CSS-Dateien.
2. **Kein Three.js vorhanden.** Hintergrund-Effekte laufen über einen 2D-Canvas
   (`CanvasBackgroundEffects.tsx`), die Vinyl ist CSS-basiert.
3. **Dependencies veraltet** (Stand `npm-check-updates`, 2026-07-12): u.a.
   Vite 7→8, ESLint 9→10, `@vitejs/plugin-react` 5→6, TypeScript 5.9→7.0,
   lucide-react 0.x→1.x, globals 16→17.
4. Foto-Assets in `public/memories/` enthalten ungenutzte HEIC/DNG-Dateien und
   teils mehrere MB große JPGs.

## Scope

### In Scope

1. **Dependency-Update auf Latest Major** (`npx npm-check-updates -u && npm install`),
   danach Build-/Lint-Verifikation. Fallback-Regel: Bricht ein einzelnes Major-Update
   den Build unlösbar (Kandidat: TypeScript 7.0), wird nur dieses Paket auf die
   letzte funktionierende Major zurückgepinnt und im Commit dokumentiert.
2. **Tailwind v4 korrekt anbinden:** `@tailwindcss/vite`-Plugin in `vite.config.ts`,
   `@import "tailwindcss"` in `index.css`, bestehende CSS-Variablen als
   `@theme`-Tokens. `tailwind.config.js`, `autoprefixer` und `postcss` entfallen
   (übernimmt Tailwind v4 selbst).
3. **Three.js-Stack:** `three`, `@react-three/fiber` (v9+, React-19-kompatibel),
   `@react-three/drei`. Versionen gemäß aktueller Docs (Context7) zum
   Implementierungszeitpunkt.
4. **3D-Hintergrund (global):** R3F-Szene ersetzt `CanvasBackgroundEffects` —
   instanzierte Herz-/Blütenblatt-Partikel mit räumlicher Tiefe, sanftem Glow und
   dezentem Parallax auf Maus/Gyroskop. Ein einziger fixer Canvas hinter allen Seiten.
5. **3D-Vinyl (VinylPage):** Zylindergeometrie mit prozedural generierter
   Rillen-Textur (Canvas-generierte Bump-Map, kein Custom-Shader), Album-Cover
   als Label-Textur, Licht-Reflexionen. Rotiert nur bei
   laufender Musik (gekoppelt an `audioRef`), neigt sich subtil zur Mausposition.
   Play/Pause- und Songwechsel-Interaktion bleiben funktional identisch.
6. **Design-Politur:**
   - Palette bleibt Lavendel/Rosa/Creme + neuer Gold-Akzent für Glows
   - Gestreifter Body-Hintergrund → weicher radialer Verlauf
   - Typografie zentralisiert: Playfair Display (italic) für Überschriften,
     Inter für UI — über Theme-Tokens statt Inline-Styles
   - Glassmorphism für Karten und `PageNavigation` (blur, halbtransparent,
     feine helle Border), weichere mehrstufige Schatten
7. **Performance & Fallbacks** (siehe unten)

### Out of Scope

- 3D-Foto-Galerie (explizit abgewählt — Polaroid-Diashow bleibt 2D)
- 3D-Elemente auf Start-, Letter- und Peony-Seite
- Inhaltliche Änderungen (Texte, Fotos, Songs)
- Deployment-Änderungen (GitHub Actions → gh-pages bleibt, inkl. `BASE_URL`-Handling)

## Architektur

```
src/three/
├── BackgroundScene.tsx    # Globaler Partikel-Canvas (ersetzt CanvasBackgroundEffects)
├── Vinyl3D.tsx            # 3D-Schallplatte (rendert im VinylRecord-Slot)
└── hooks/
    └── useWebGL.ts        # WebGL-Erkennung + prefers-reduced-motion
```

- **Canvas-Budget:** max. 2 WebGL-Kontexte gleichzeitig (globaler Hintergrund +
  Vinyl-Canvas, nur wenn VinylPage aktiv ist — Seiten werden via AnimatePresence
  unmounted).
- `Vinyl3D` wird per `React.lazy` code-gesplittet, damit die Startseite klein bleibt.
- `VinylRecord.tsx` behält seine Props-Schnittstelle (`audioRef`, `coverImage`,
  `onNextSong`, `onPrevSong`); intern rendert es den 3D-Canvas statt CSS-Scheibe.
  UI-Elemente (Buttons, Song-Skip) bleiben 2D-DOM über dem Canvas.

## Datenfluss

- Play-Zustand: `audioRef.current.paused` wird im R3F-`useFrame`-Loop gelesen
  (kein zusätzlicher State, keine Re-Renders) und steuert die Rotations-
  geschwindigkeit mit sanftem Beschleunigen/Abbremsen.
- Cover-Textur: `useTexture`/`TextureLoader` mit `resolvePath()` für
  GitHub-Pages-Basis-Pfad; Wechsel bei Songwechsel über Prop.

## Fehlerbehandlung

- **Kein WebGL / Context-Loss:** `useWebGL`-Hook erkennt fehlenden Support;
  Fallback ist der bestehende 2D-Canvas (`CanvasBackgroundEffects` bleibt im
  Repo als Fallback-Pfad) bzw. die bisherige CSS-Vinyl.
- **`prefers-reduced-motion`:** Partikel statisch (keine Bewegung), Vinyl ohne
  Taumel-/Parallax-Effekt, nur langsame Rotation bei Musik.
- **Textur-Ladefehler:** Vinyl rendert mit neutralem Label weiter (Suspense-
  Fallback + ErrorBoundary um den Canvas).

## Performance (Mobile-first)

- `dpr={[1, 2]}` (Device-Pixel-Ratio-Deckel)
- Instanced Meshes für Partikel (ein Draw-Call pro Form)
- Kein Postprocessing-Bloom auf Mobile; Glow über additive Sprite-Texturen
- Antialiasing aus, wenn `devicePixelRatio > 1.5`

## Verifikation

1. `npm run build` und `npm run lint` grün
2. Playwright: Screenshots aller 5 Seiten in Desktop- (1280×800) und
   Mobile-Viewport (390×844); Sichtprüfung Vinyl-Rotation bei Play/Pause
3. Manuelle Prüfung des deployten Stands auf GitHub Pages

## Offene Punkte / Notizen

- Untracked Datei `public/Notiz 09.07.2025 02_12_13.pdf` liegt im Working Tree —
  wird nicht angefasst; Entscheidung über Commit liegt beim User.
- Ungenutzte HEIC/DNG-Dateien in `public/memories/` blähen das Deployment auf;
  Aufräumen ist optionaler Folgeschritt, nicht Teil dieses Overhauls.
