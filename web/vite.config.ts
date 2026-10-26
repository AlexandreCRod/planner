import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app's version, from the Android build (the one place it's bumped), sent with each sync.
const version = /versionName\s+"([^"]+)"/.exec(readFileSync("android/app/build.gradle", "utf8"))?.[1] ?? "dev";

// `npm run dev` proxies the API to a local `wrangler dev` (server/), so the app works the same
// as when the Worker serves it.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: { outDir: "dist", emptyOutDir: true },
});
