import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  plugins: [react(), tailwindcss()],
  base: "/Tatjana_ein_j-hriges/",
  build: {
    rolldownOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
