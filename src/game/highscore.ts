/**
 * Highscore-Persistenz ohne Backend (Seite ist nur für uns zwei):
 * - Seed: public/game/highscore.json, committet im Repo.
 * - Laufzeit: localStorage (überlebt Reloads auf demselben Gerät).
 * - Dev-Modus: neue Rekorde werden zusätzlich per POST /__highscore in die
 *   Repo-Datei zurückgeschrieben (Vite-Plugin in vite.config.ts) und landen
 *   so mit dem nächsten Commit in der Historie.
 */

const STORAGE_KEY = "arcade.highscore.v1";

function readLocal(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    // localStorage kann fehlen/verboten sein (z. B. Private Mode) — dann
    // zählt nur der Repo-Seed.
    return 0;
  }
}

let seedPromise: Promise<number> | null = null;

async function readSeed(): Promise<number> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}game/highscore.json`, {
      cache: "no-cache",
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { best?: unknown };
    const value = Number(data.best);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

/** Effektiver Bestwert = max(Repo-Seed, localStorage). */
export function loadHighscore(): Promise<number> {
  seedPromise ??= readSeed();
  return seedPromise.then((seed) => Math.max(seed, readLocal()));
}

/**
 * Meldet einen erreichten Score. Erwartet, dass der Aufrufer nur bei einem
 * echten neuen Rekord aufruft (score > bisheriger Bestwert aus
 * loadHighscore) — erst dann wird die Dev-Rückschreibung ausgelöst.
 * Gibt den neuen Bestwert zurück.
 */
export function submitScore(score: number): number {
  const rounded = Math.floor(score);
  const best = Math.max(readLocal(), rounded);
  try {
    localStorage.setItem(STORAGE_KEY, String(best));
  } catch {
    // Kein localStorage — Rekord gilt nur für diese Session.
  }
  if (import.meta.env.DEV) {
    void fetch("/__highscore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ best }),
    }).catch(() => {
      // Dev-Server ohne Plugin oder offline — localStorage reicht.
    });
  }
  return best;
}
