import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Dev-only: schreibt neue Arcade-Highscores in public/game/highscore.json
 *  zurück, damit lokal erspielte Rekorde mit dem nächsten Commit im Repo
 *  landen (kein Backend — die Seite ist nur für uns zwei). In Produktion
 *  existiert der Endpoint nicht; dort übernimmt localStorage. */
function highscoreDevWriter(): Plugin {
  return {
    name: "highscore-dev-writer",
    configureServer(server) {
      server.middlewares.use("/__highscore", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          void (async () => {
            const file = path.join(
              server.config.root,
              "public/game/highscore.json",
            );
            try {
              const best = Number(
                (JSON.parse(body) as { best?: unknown }).best,
              );
              if (!Number.isInteger(best) || best <= 0 || best > 10_000_000) {
                res.statusCode = 400;
                res.end("bad score");
                return;
              }
              // Nie einen höheren, bereits gespeicherten Rekord überschreiben.
              let current = 0;
              try {
                const raw = JSON.parse(await readFile(file, "utf8")) as {
                  best?: unknown;
                };
                current = Number(raw.best) || 0;
              } catch {
                /* Datei fehlt/kaputt — als 0 behandeln */
              }
              if (best > current) {
                await writeFile(
                  file,
                  JSON.stringify(
                    {
                      best,
                      holder: "local",
                      date: new Date().toISOString().slice(0, 10),
                    },
                    null,
                    2,
                  ) + "\n",
                );
              }
              res.statusCode = 204;
              res.end();
            } catch {
              res.statusCode = 400;
              res.end("bad request");
            }
          })();
        });
      });
    },
  };
}

/** Stabile Vendor-Chunks für besseres Browser-Caching zwischen Deploys:
 *  react/react-dom/scheduler ändern sich selten, three/@react-three (groß,
 *  ~230kB gzip) und framer-motion getrennt, damit ein App-Update nicht den
 *  kompletten Vendor-Code neu herunterladen lässt. */
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (
    id.includes("node_modules/react/") ||
    id.includes("node_modules/react-dom/") ||
    id.includes("node_modules/scheduler/")
  ) {
    return "react-vendor";
  }
  if (
    id.includes("node_modules/three/") ||
    id.includes("node_modules/@react-three/")
  ) {
    return "three-vendor";
  }
  if (id.includes("node_modules/framer-motion/")) {
    return "motion";
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), highscoreDevWriter()],
  base: "/Tatjana_ein_j-hriges/",
  build: {
    rolldownOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
