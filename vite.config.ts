import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keep the browser's Host, as Caddy does in production, so the API's
      // same-site check on owner-only writes accepts local requests.
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
});
