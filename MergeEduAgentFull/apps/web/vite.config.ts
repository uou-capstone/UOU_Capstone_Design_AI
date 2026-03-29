import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.PORT ? `http://localhost:${process.env.PORT}` : "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": target,
      "/uploads": target
    }
  }
});
