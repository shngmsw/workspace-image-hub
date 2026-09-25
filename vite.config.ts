import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devServer({ entry: "src/server/dev.ts", exclude: [/^\/src\/.*/, /^\/@.*/, /^\/node_modules\/.*/] }),
  ],
  server: {
    watch: { ignored: ["**/data/**", "**/dist/**"] },
  },
  build: {
    outDir: "dist/client",
    assetsDir: "static",
  },
});
