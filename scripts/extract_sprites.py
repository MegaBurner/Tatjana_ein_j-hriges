#!/usr/bin/env python3
"""Extrahiert benannte Sprite-Frames aus dem KI-Spritesheet in einen Atlas.

Pipeline:
  1. "Clearen":  Der eingebackene Schachbrett-Hintergrund (Grau ~172/~111
     inkl. Antialiasing-Zwischentoene) wird per Flood-Fill vom Bildrand
     entfernt — nur grau-aehnliche Pixel, die mit dem Rand verbunden sind,
     werden transparent. Graue Details im Sprite-Inneren (Staubwolken)
     bleiben erhalten, weil sie nicht grau-verbunden zum Rand sind.
  2. "Trennen":  Jedes REGIONS-Rechteck wird auf seinen Inhalt (Alpha > 0)
     getrimmt und als ein Frame extrahiert. Die Rechtecke sind manuell
     anhand des Debug-Overlays eingemessen — das KI-Sheet hat kein Grid.
     Eingebackene Text-Labels liegen ausserhalb aller Regionen.
  3. "Sortieren": Frame-Namen folgen der Konvention kategorie/name_index.
  4. Export:      Shelf-gepackter Atlas public/game/atlas.png + atlas.json.

Debug:  python3 scripts/extract_sprites.py --debug
        schreibt ein Overlay (erkannte Komponenten nummeriert + REGIONS
        eingezeichnet) und druckt die Komponenten-Boxen zum Einmessen.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "art" / "dino-spritesheet.png"
OUT_DIR = REPO / "public" / "game"
DEBUG_DIR = Path(
    "/private/tmp/claude-501/-Users-melihcosgun-Documents-Projekte-Tatjana-ein-j-hriges/"
    "aea600c2-3861-4a92-a825-32f8a2babd8c/scratchpad"
)

# --- Hintergrund-Erkennung --------------------------------------------------
# Schachbrett-Toene: hell ~172, dunkel ~111. Antialiasing an den Kachelkanten
# erzeugt Zwischentoene — daher zaehlt der gesamte gering-gesaettigte
# Grau-Korridor zwischen beiden Toenen als "hintergrund-aehnlich".
GRAY_MAX_CHROMA = 14  # max. Kanalabweichung |R-G|,|R-B|,|G-B|
GRAY_MIN_VALUE = 95
GRAY_MAX_VALUE = 190

MIN_COMPONENT_AREA = 500  # Debug: kleinere Komponenten nicht listen

ATLAS_MAX_WIDTH = 2048
ATLAS_PADDING = 2  # px Abstand zwischen Frames (gegen Texture-Bleeding)

# --- Manuell eingemessene Frame-Regionen (x0, y0, x1, y1 im Quellbild) ------
# Wird anhand des Debug-Overlays getuned; leere Liste = nur Debug sinnvoll.
REGIONS: list[tuple[str, int, int, int, int]] = [
    # --- Spieler (Reihe 1): Idle / Walk / Jump / Duck ---
    ("player/idle_0", 70, 70, 200, 330),
    ("player/idle_1", 300, 70, 425, 330),
    ("player/idle_2", 490, 70, 620, 330),
    ("player/walk_0", 655, 70, 800, 330),
    ("player/walk_1", 835, 80, 990, 330),
    ("player/walk_2", 1005, 85, 1165, 330),
    ("player/walk_3", 1175, 80, 1345, 330),
    ("player/walk_4", 1390, 80, 1530, 330),
    ("player/jump_0", 1645, 85, 1795, 335),
    ("player/jump_1", 1840, 65, 1990, 330),
    ("player/duck_0", 2105, 115, 2255, 335),
    ("player/duck_1", 2285, 125, 2440, 335),
    ("player/duck_2", 2535, 100, 2680, 330),
    # --- Spieler (Reihe 2): Lauf-Zyklus inkl. Staubwolken links ---
    ("player/run_0", 320, 455, 510, 712),
    ("player/run_1", 512, 455, 768, 712),
    ("player/run_2", 772, 455, 1020, 712),
    # --- Voegel (Gegner), 2 Farben x 6 Flug-Frames ---
    ("bird/yellow_0", 45, 835, 175, 985),
    ("bird/yellow_1", 190, 855, 320, 985),
    ("bird/yellow_2", 330, 870, 455, 985),
    ("bird/yellow_3", 465, 845, 600, 985),
    ("bird/yellow_4", 600, 850, 740, 972),
    ("bird/yellow_5", 740, 825, 875, 958),
    ("bird/red_0", 45, 1000, 175, 1112),
    ("bird/red_1", 195, 1000, 320, 1120),
    ("bird/red_2", 330, 1015, 455, 1118),
    ("bird/red_3", 468, 985, 600, 1110),
    ("bird/red_4", 600, 995, 740, 1105),
    ("bird/red_5", 745, 955, 870, 1080),
    # --- Kakteen (4 Varianten) + wiederholbare Bodenkachel ---
    ("cactus/small", 1005, 970, 1100, 1100),
    ("cactus/medium", 1150, 930, 1315, 1100),
    ("cactus/large", 1345, 871, 1535, 1100),
    ("cactus/double", 1560, 871, 1730, 1100),
    ("ground/tile", 1815, 970, 2712, 1090),
    # --- Tatjana: Idle / Wave; "hearts" = Lady mit aufsteigenden Herzen ---
    ("lady/idle_0", 520, 1270, 700, 1536),
    ("lady/idle_1", 750, 1270, 895, 1536),
    ("lady/idle_2", 980, 1270, 1145, 1536),
    ("lady/idle_3", 60, 1270, 210, 1536),
    ("lady/wave_0", 1195, 1270, 1370, 1536),
    ("lady/wave_1", 1435, 1270, 1600, 1536),
    ("lady/wave_2", 1650, 1270, 1825, 1536),
    ("lady/hearts_0", 2015, 1260, 2170, 1536),
    ("lady/hearts_1", 2255, 1215, 2420, 1536),
    ("lady/hearts_2", 2470, 1215, 2670, 1536),
    # --- Einzelne Herzen fuer Partikel-Effekte ---
    ("fx/heart_0", 2120, 1264, 2162, 1305),
    ("fx/heart_1", 2365, 1263, 2418, 1312),
    ("fx/heart_2", 255, 1280, 350, 1360),
]


def load_rgba() -> np.ndarray:
    im = Image.open(SRC).convert("RGBA")
    return np.array(im)


def background_mask(rgba: np.ndarray) -> np.ndarray:
    """True fuer Pixel, die zum rand-verbundenen Grau-Hintergrund gehoeren."""
    rgb = rgba[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    chroma = np.maximum(np.maximum(abs(r - g), abs(r - b)), abs(g - b))
    value = rgb.max(axis=2)
    grayish = (
        (chroma <= GRAY_MAX_CHROMA)
        & (value >= GRAY_MIN_VALUE)
        & (value <= GRAY_MAX_VALUE)
    )
    labels, _ = ndimage.label(grayish, structure=np.ones((3, 3), dtype=int))
    border_labels = np.unique(
        np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
    )
    border_labels = border_labels[border_labels != 0]
    return np.isin(labels, border_labels)


def cleaned_image(rgba: np.ndarray) -> np.ndarray:
    """Hintergrund transparent + 1px-Kantenerosion gegen graue Saeume."""
    bg = background_mask(rgba)
    fg = ~bg
    fg = ndimage.binary_erosion(fg, structure=np.ones((3, 3), dtype=bool))
    out = rgba.copy()
    out[:, :, 3] = np.where(fg, 255, 0).astype(np.uint8)
    return out


def component_boxes(alpha: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Bounding-Boxen (x0, y0, x1, y1) aller Vordergrund-Komponenten."""
    labels, count = ndimage.label(alpha > 0, structure=np.ones((3, 3), dtype=int))
    boxes = []
    for sl in ndimage.find_objects(labels):
        if sl is None:
            continue
        ys, xs = sl
        area = (ys.stop - ys.start) * (xs.stop - xs.start)
        if area < MIN_COMPONENT_AREA:
            continue
        boxes.append((xs.start, ys.start, xs.stop, ys.stop))
    return sorted(boxes, key=lambda box: (box[1] // 200, box[0]))


def write_debug(rgba: np.ndarray) -> None:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    boxes = component_boxes(rgba[:, :, 3])
    im = Image.fromarray(rgba).convert("RGB")
    draw = ImageDraw.Draw(im)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        draw.rectangle([x0, y0, x1, y1], outline=(255, 0, 0), width=3)
        draw.text((x0 + 4, max(0, y0 - 28)), str(i), fill=(255, 0, 0))
        print(
            f"  comp {i:3d}: x={x0:4d}..{x1:4d}  y={y0:4d}..{y1:4d}  "
            f"w={x1 - x0:4d} h={y1 - y0:4d}"
        )
    for name, x0, y0, x1, y1 in REGIONS:
        draw.rectangle([x0, y0, x1, y1], outline=(0, 120, 255), width=2)
        draw.text((x0 + 4, y0 + 4), name, fill=(0, 120, 255))
    out = DEBUG_DIR / "sprite_debug.png"
    im.save(out)
    print(f"Debug-Overlay: {out}  ({len(boxes)} Komponenten)")


def extract_frames(rgba: np.ndarray) -> dict[str, np.ndarray]:
    """Regionen zuschneiden und auf Inhalt trimmen. Warnt bei Problemen."""
    frames: dict[str, np.ndarray] = {}
    problems = []
    for name, x0, y0, x1, y1 in REGIONS:
        crop = rgba[y0:y1, x0:x1]
        alpha = crop[:, :, 3]
        ys, xs = np.nonzero(alpha)
        if len(ys) == 0:
            problems.append(f"{name}: Region ist leer")
            continue
        ty0, ty1, tx0, tx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        if ty0 == 0 or tx0 == 0 or ty1 == alpha.shape[0] or tx1 == alpha.shape[1]:
            problems.append(f"{name}: Inhalt beruehrt Regionsrand (zu eng?)")
        frames[name] = crop[ty0:ty1, tx0:tx1]
    for p in problems:
        print(f"WARNUNG {p}", file=sys.stderr)
    return frames


def pack_atlas(frames: dict[str, np.ndarray]) -> tuple[np.ndarray, dict]:
    """Einfaches Shelf-Packing, sortiert nach Hoehe (stabil per Name)."""
    order = sorted(frames, key=lambda n: (-frames[n].shape[0], n))
    placements: dict[str, tuple[int, int]] = {}
    x = y = shelf_h = 0
    for name in order:
        h, w = frames[name].shape[:2]
        if x + w > ATLAS_MAX_WIDTH:
            y += shelf_h + ATLAS_PADDING
            x = shelf_h = 0
        placements[name] = (x, y)
        x += w + ATLAS_PADDING
        shelf_h = max(shelf_h, h)
    atlas_h = y + shelf_h
    atlas = np.zeros((atlas_h, ATLAS_MAX_WIDTH, 4), dtype=np.uint8)
    meta = {"size": {"w": ATLAS_MAX_WIDTH, "h": int(atlas_h)}, "frames": {}}
    for name, (px, py) in placements.items():
        f = frames[name]
        atlas[py : py + f.shape[0], px : px + f.shape[1]] = f
        meta["frames"][name] = {
            "x": int(px),
            "y": int(py),
            "w": int(f.shape[1]),
            "h": int(f.shape[0]),
        }
    return atlas, meta


def main() -> None:
    rgba = cleaned_image(load_rgba())
    if "--debug" in sys.argv:
        write_debug(rgba)
        return
    if not REGIONS:
        print("REGIONS ist leer — erst mit --debug einmessen.", file=sys.stderr)
        sys.exit(1)
    frames = extract_frames(rgba)
    atlas, meta = pack_atlas(frames)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas).save(OUT_DIR / "atlas.png", optimize=True)
    (OUT_DIR / "atlas.json").write_text(json.dumps(meta, indent=1))
    print(
        f"OK: {len(frames)} frames -> {OUT_DIR / 'atlas.png'} "
        f"({meta['size']['w']}x{meta['size']['h']})"
    )
    for name in sorted(meta["frames"]):
        f = meta["frames"][name]
        print(f"  {name:20s} {f['w']:4d}x{f['h']:4d}")


if __name__ == "__main__":
    main()
