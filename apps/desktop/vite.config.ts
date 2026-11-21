import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { checkSyncServerUrl } from "../../packages/sync-core/src/server-url";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    // Whether this build syncs notes. Development builds may use a sync
    // server on this machine over plain http, as the native side allows.
    __SONOLECT_SYNC__: JSON.stringify(
      checkSyncServerUrl(process.env.SONOLECT_SYNC_URL, {
        allowLocalHttp: mode !== "production",
      }).ok,
    ),
  },
  // Vite 6's "modules" default, kept for older WebKit (macOS 10.15 in tauri.conf.json).
  build: { target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"] },
}));
