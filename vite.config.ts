import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localCoreProxy = {
  target: "http://127.0.0.1:4179",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", strictPort: true, proxy: { "/api/local": localCoreProxy } },
  preview: { host: "127.0.0.1", strictPort: true, proxy: { "/api/local": localCoreProxy } },
});
