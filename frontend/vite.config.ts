import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the page is served by Vite and /api is proxied to the backend, so the browser sees one origin and the
// backend needs no CORS. The port below is where the development origin comes from: the browser sends
// Origin: http://localhost:5173, so when you run the backend by hand, set ALLOWED_ORIGINS=http://localhost:5173 in your own
// shell (add http://127.0.0.1:5173 if you browse by IP). That value is for development only: it must never be put in
// deploy/.env or any production setting, where ALLOWED_ORIGINS is the public https address.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://localhost:8081" } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
