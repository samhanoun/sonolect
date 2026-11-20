import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite 6's "modules" default, kept for older WebKit (macOS 10.15 in tauri.conf.json).
  build: { target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"] },
});
