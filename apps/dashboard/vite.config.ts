import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  server: { proxy: { "/api": "http://127.0.0.1:8787", "/agents": { target: "ws://127.0.0.1:8787", ws: true } } },
});
