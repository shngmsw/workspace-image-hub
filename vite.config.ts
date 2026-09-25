import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // One dev port serves the SPA with HMR and the real Hono app, composed exactly like main.ts.
    devServer({ entry: "src/server/dev.ts", exclude: [/^\/src\/.*/, /^\/@.*/, /^\/node_modules\/.*/] }),
  ],
  build: {
    outDir: "dist/client",
    // `static/` rather than Vite's default `assets/`, so build files never look like /api/assets.
    assetsDir: "static",
  },
});
